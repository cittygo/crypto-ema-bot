import ccxt from 'ccxt';
import pkg from 'technicalindicators';
// Added ATR for Stop-Loss & Take-Profit calculation
const { RSI, ADX, ATR } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

const timeframes = ['4h', '1d', '1w'];
const majorCoins = ['BTC/USDT', 'BNB/USDT', 'SOL/USDT', 'ETH/USDT'];

async function getFilteredPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filtered = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const base = symbol.split(':')[0];
            const isMajor = majorCoins.includes(base);
            const isCheap = ticker.last < 10 && symbol.endsWith('USDT');

            if ((isMajor || isCheap) && ticker.quoteVolume > 100000) {
                filtered.push({
                    symbol,
                    change: ticker.percentage,
                    volume: ticker.quoteVolume
                });
            }
        }
        filtered.sort((a, b) => b.volume - a.volume);
        return filtered.slice(0, 350);
    } catch (e) { return []; }
}

async function analyzeCoin(coinObj, timeframe) {
    try {
        const symbol = coinObj.symbol;
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return null;

        // OHLC for Patterns and Indicators
        const openPrices = candles.map(c => c[1]);
        const highPrices = candles.map(c => c[2]);
        const lowPrices = candles.map(c => c[3]);
        const closePrices = candles.map(c => c[4]);
        const volumes = candles.map(c => c[5]);
        
        const lastPrice = closePrices[closePrices.length - 1];
        
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });
        const lastRsi = rsiArr[rsiArr.length - 1];
        const prevRsi = rsiArr[rsiArr.length - 2];

        const isRsiRising = lastRsi > prevRsi;
        const isRsiFalling = lastRsi < prevRsi;

        const adxArr = ADX.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
        if (!lastRsi || adxArr.length < 2) return null;

        const lastAdx = adxArr[adxArr.length - 1].adx;
        const prevAdx = adxArr[adxArr.length - 2].adx;
        const isExhausted = prevAdx > 25 && lastAdx < prevAdx;

        const atrArr = ATR.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
        const lastAtr = atrArr[atrArr.length - 1];

        const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVol = volumes[volumes.length - 1];
        const volSpike = currentVol > avgVol * 2; 

        // --- CANDLESTICK PATTERN RECOGNITION ---
        const len = closePrices.length;
        const O1 = openPrices[len - 2], H1 = highPrices[len - 2], L1 = lowPrices[len - 2], C1 = closePrices[len - 2];
        const O2 = openPrices[len - 1], H2 = highPrices[len - 1], L2 = lowPrices[len - 1], C2 = closePrices[len - 1];
        
        const body = Math.abs(C2 - O2);
        const lowerWick = Math.min(O2, C2) - L2;
        const upperWick = H2 - Math.max(O2, C2);
        
        let candlePattern = "Normal";
        
        if (C1 < O1 && C2 > O2 && O2 <= C1 && C2 >= O1) {
            candlePattern = "🐂 Bullish Engulfing";
        } else if (lowerWick >= 2 * body && upperWick <= body * 0.5 && body > 0) {
            candlePattern = "🔨 Hammer (Bullish)";
        } 
        else if (C1 > O1 && C2 < O2 && O2 >= C1 && C2 <= O1) {
            candlePattern = "🐻 Bearish Engulfing";
        } else if (upperWick >= 2 * body && lowerWick <= body * 0.5 && body > 0) {
            candlePattern = "🌠 Shooting Star (Bearish)";
        }

        let side = "", emoji = "", strength = "Standard", priority = 3, adxStatus = "";

        // --- STRICT FILTER LOGIC (ONLY PERFECT SIGNALS) ---
        if (lastRsi >= 10 && lastRsi <= 30) {
            if (isExhausted && isRsiRising) {
                side = "LONG Opportunity"; emoji = "🟢";
                if (lastRsi <= 20) { strength = "Extreme Oversold"; priority = 1; }
                adxStatus = "🔥 SELLERS EXHAUSTED (Sniper Entry)";
            } else {
                return null; // SILENT REJECT: It's a falling knife, do not send message.
            }
        } 
        else if (lastRsi >= 70 && lastRsi <= 100) {
            if (isExhausted && isRsiFalling) {
                side = "SHORT Opportunity"; emoji = "🔴";
                if (lastRsi >= 80) { strength = "Extreme Overbought"; priority = 1; }
                adxStatus = "🔥 BUYERS EXHAUSTED (Sniper Entry)";
            } else {
                return null; // SILENT REJECT: It's still pumping, do not send message.
            }
        }

        if (side) {
            const base = symbol.split('/')[0];
            if (priority !== 1 && majorCoins.includes(`${base}/USDT`)) priority = 2;

            let sl, tp1, tp2;
            if (side.includes("LONG")) {
                sl = lastPrice - (lastAtr * 1.5);
                tp1 = lastPrice + (lastAtr * 1.5);
                tp2 = lastPrice + (lastAtr * 3.0);
            } else {
                sl = lastPrice + (lastAtr * 1.5);
                tp1 = lastPrice - (lastAtr * 1.5);
                tp2 = lastPrice - (lastAtr * 3.0);
            }

            let whaleAlert = "Normal";
            try {
                const funding = await exchange.fetchFundingRate(symbol);
                if (funding && funding.fundingRate !== undefined) {
                    const fr = funding.fundingRate * 100;
                    if (side.includes("LONG") && fr < -0.01) {
                        whaleAlert = `🔥 SHORT SQUEEZE POTENTIAL (${fr.toFixed(4)}%)`;
                    } else if (side.includes("SHORT") && fr > 0.01) {
                        whaleAlert = `🐋 WHALES BUYING (${fr.toFixed(4)}%)`;
                    } else {
                        whaleAlert = `${fr.toFixed(4)}%`;
                    }
                }
            } catch (e) { whaleAlert = "N/A"; }

            let mtfStatus = "N/A";
            let htf = timeframe === '4h' ? '1d' : (timeframe === '1d' ? '1w' : null);
            if (htf) {
                try {
                    const htfCandles = await exchange.fetchOHLCV(symbol, htf, undefined, 50);
                    if (htfCandles.length > 20) {
                        const htfClose = htfCandles.map(c => c[4]);
                        const htfRsi = RSI.calculate({ period: 14, values: htfClose }).pop();
                        
                        if (side.includes("LONG") && htfRsi < 50) {
                            mtfStatus = `🌟 MATCHED (${htf} RSI is Bullish: ${htfRsi.toFixed(1)})`;
                        } else if (side.includes("SHORT") && htfRsi > 50) {
                            mtfStatus = `🌟 MATCHED (${htf} RSI is Bearish: ${htfRsi.toFixed(1)})`;
                        } else {
                            mtfStatus = `⚠️ HTF AGAINST (${htf} RSI: ${htfRsi.toFixed(1)})`;
                        }
                    }
                } catch (e) { mtfStatus = "Data Error"; }
            } else { mtfStatus = "Max TF Reached"; }

            return {
                symbol: base,
                timeframe,
                price: lastPrice,
                rsi: lastRsi,
                rsiTrend: isRsiRising ? "⬆️ Rising" : "⬇️ Falling",
                change: coinObj.change,
                volSpike: volSpike ? "🔥 VOLUME SPIKE!" : "Normal",
                candlePattern: candlePattern, 
                adxStatus,
                side,
                emoji,
                strength,
                priority,
                sl: sl.toPrecision(5),
                tp1: tp1.toPrecision(5),
                tp2: tp2.toPrecision(5),
                whaleAlert,
                mtfStatus,
                url: `https://www.tradingview.com/chart/?symbol=BINANCE:${base}USDT.P`
            };
        }
    } catch (e) {}
    return null;
}

async function run() {
    try {
        const coins = await getFilteredPairs();
        let allSignals = [];

        await bot.sendMessage(chatId, `🔍 *Ultra-Pro Scanner Started*\nTarget: Only 100% PERFECT Sniper Entries...\nTotal Coins: ${coins.length}`);

        for (const tf of timeframes) {
            for (const coinObj of coins) {
                const signal = await analyzeCoin(coinObj, tf);
                if (signal) allSignals.push(signal);
                await new Promise(res => setTimeout(res, 400));
            }
        }

        allSignals.sort((a, b) => a.priority - b.priority);

        if (allSignals.length === 0) {
            await bot.sendMessage(chatId, "✅ Scan complete. Market is risky right now. No perfect signals found. I'll keep watching!");
            return;
        }

        for (const s of allSignals) {
            const msg = `
${s.emoji} *${s.side}*
--------------------------
🎯 *ADX Trend:* ${s.adxStatus}
🌟 *Multi-TF:* ${s.mtfStatus}
🐋 *Funding (Whales):* ${s.whaleAlert}
--------------------------
📊 *Priority:* ${s.priority === 1 ? "🔥 EXTREME" : s.priority === 2 ? "⭐ MAJOR" : "✅ NORMAL"}
📈 *RSI:* ${s.rsi.toFixed(2)} (${s.rsiTrend})
📉 *Strength:* ${s.strength}
⚡ *Vol Surge:* ${s.volSpike}
🕯️ *Candle Pattern:* ${s.candlePattern}
📊 *24h Change:* ${s.change}%
🪙 *Coin:* #${s.symbol}
⏰ *TF:* ${s.timeframe} | 💰 *Price:* ${s.price}
--------------------------
💵 *Take Profit:* ${s.tp1} | ${s.tp2}
🛑 *Stop Loss:* ${s.sl}
--------------------------
🔗 [Open Binance Chart](${s.url})`;
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            await new Promise(res => setTimeout(res, 500));
        }

        const longCount = allSignals.filter(s => s.side.includes("LONG")).length;
        const shortCount = allSignals.filter(s => s.side.includes("SHORT")).length;

        await bot.sendMessage(chatId, `✅ *Scan Report Summary*\nPerfect Signals: ${allSignals.length}\n🟢 Longs: ${longCount} | 🔴 Shorts: ${shortCount}`);
    } catch (error) { console.error(error.message); }
}

run();
