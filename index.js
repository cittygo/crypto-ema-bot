import ccxt from 'ccxt';
import pkg from 'technicalindicators';
// Added MACD, ATR, and EMA for the new features
const { RSI, ADX, MACD, ATR, EMA } = pkg;
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
        // Increased candle limit to 250 to calculate 200 EMA
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 250);
        if (candles.length < 200) return null;

        // Extracting High, Low, Close for Indicators
        const highPrices = candles.map(c => c[2]);
        const lowPrices = candles.map(c => c[3]);
        const closePrices = candles.map(c => c[4]);
        const volumes = candles.map(c => c[5]);
        
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });
        const lastRsi = rsiArr[rsiArr.length - 1];
        const prevRsi = rsiArr[rsiArr.length - 2];

        // ADX Calculation
        const adxArr = ADX.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
        if (!lastRsi || adxArr.length < 2) return null;

        const lastAdx = adxArr[adxArr.length - 1].adx;
        const prevAdx = adxArr[adxArr.length - 2].adx;
        const isExhausted = prevAdx > 25 && lastAdx < prevAdx;

        // Volume Spike Detection
        const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVol = volumes[volumes.length - 1];
        const volSpike = currentVol > avgVol * 2; 

        // 1. MACD Calculation
        const macdArr = MACD.calculate({ values: closePrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
        const lastMacd = macdArr[macdArr.length - 1];

        // 2. ATR Calculation (For Auto TP/SL)
        const atrArr = ATR.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
        const lastAtr = atrArr[atrArr.length - 1];

        // 3. 200 EMA Calculation (For Trend Confluence)
        const ema200Arr = EMA.calculate({ period: 200, values: closePrices });
        const lastEma200 = ema200Arr[ema200Arr.length - 1];

        let side = "", emoji = "", strength = "Standard", priority = 3, adxStatus = "";

        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "LONG Opportunity"; emoji = "🟢";
            if (lastRsi <= 20) { strength = "Extreme Oversold"; priority = 1; }
            adxStatus = isExhausted ? "🔥 SELLERS EXHAUSTED (Sniper Entry)" : "⚠️ Falling Knife (High Risk, Wait)";
        } else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "SHORT Opportunity"; emoji = "🔴";
            if (lastRsi >= 80) { strength = "Extreme Overbought"; priority = 1; }
            adxStatus = isExhausted ? "🔥 BUYERS EXHAUSTED (Sniper Entry)" : "⚠️ Still Pumping (High Risk, Wait)";
        }

        if (side) {
            const base = symbol.split('/')[0];
            if (priority !== 1 && majorCoins.includes(`${base}/USDT`)) priority = 2;
            const lastPrice = closePrices[closePrices.length - 1];

            // 4. Feature Logic Injections
            
            // MACD Confirmation
            let macdStatus = "⏳ Awaiting Cross";
            if (lastMacd) {
                const isMacdBullish = lastMacd.MACD > lastMacd.signal;
                if (side.includes("LONG") && isMacdBullish) macdStatus = "⚡ MACD BULLISH CONFIRMED";
                else if (side.includes("SHORT") && !isMacdBullish) macdStatus = "⚡ MACD BEARISH CONFIRMED";
            }

            // Trend Confluence (200 EMA)
            let trendConfluence = "⚠️ Counter-Trend";
            if (lastEma200) {
                const isBullishTrend = lastPrice > lastEma200;
                if (side.includes("LONG") && isBullishTrend) trendConfluence = "🌟 TREND ALIGNED (Above 200 EMA)";
                else if (side.includes("SHORT") && !isBullishTrend) trendConfluence = "🌟 TREND ALIGNED (Below 200 EMA)";
            }

            // Auto TP & SL (using ATR multiplier)
            let tp1 = 0, tp2 = 0, sl = 0;
            if (side.includes("LONG")) {
                sl = lastPrice - (lastAtr * 1.5);
                tp1 = lastPrice + (lastAtr * 1.5);
                tp2 = lastPrice + (lastAtr * 3.0);
            } else {
                sl = lastPrice + (lastAtr * 1.5);
                tp1 = lastPrice - (lastAtr * 1.5);
                tp2 = lastPrice - (lastAtr * 3.0);
            }

            // Whale Tracker (Funding Rate)
            let whaleAlert = "Normal";
            try {
                const fundingInfo = await exchange.fetchFundingRate(symbol);
                if (fundingInfo && fundingInfo.fundingRate) {
                    if (fundingInfo.fundingRate < -0.0001) whaleAlert = "🔥 SHORT SQUEEZE ALERT (Negative FR)";
                    else if (fundingInfo.fundingRate > 0.0001) whaleAlert = "🐋 LONGS TRAPPED (High FR)";
                }
            } catch (e) {} // Silent ignore for funding API errors

            return {
                symbol: base,
                timeframe,
                price: lastPrice,
                rsi: lastRsi,
                rsiTrend: lastRsi > prevRsi ? "⬆️ Rising" : "⬇️ Falling",
                change: coinObj.change,
                volSpike: volSpike ? "🔥 VOLUME SPIKE!" : "Normal",
                adxStatus,
                macdStatus,
                trendConfluence,
                whaleAlert,
                tp1, tp2, sl,
                side,
                emoji,
                strength,
                priority,
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

        await bot.sendMessage(chatId, `🔍 *Professional Scanner v3.0 Started*\nChecking ADX, MACD, Whale Tracker & Auto TP/SL...\nTotal Coins: ${coins.length}`);

        for (const tf of timeframes) {
            for (const coinObj of coins) {
                const signal = await analyzeCoin(coinObj, tf);
                if (signal) allSignals.push(signal);
                await new Promise(res => setTimeout(res, 400));
            }
        }

        allSignals.sort((a, b) => a.priority - b.priority);

        if (allSignals.length === 0) {
            await bot.sendMessage(chatId, "✅ Scan complete. No signals found.");
            return;
        }

        for (const s of allSignals) {
            const msg = `
${s.emoji} *${s.side}*
--------------------------
🎯 *ADX Trend:* ${s.adxStatus}
⚡ *MACD:* ${s.macdStatus}
🌟 *Macro:* ${s.trendConfluence}
🐋 *Whales:* ${s.whaleAlert}
--------------------------
💰 *Price:* ${s.price}
🎯 *TP1:* ${parseFloat(s.tp1.toFixed(5))} | *TP2:* ${parseFloat(s.tp2.toFixed(5))}
🛑 *Stop-Loss:* ${parseFloat(s.sl.toFixed(5))}
--------------------------
📊 *Priority:* ${s.priority === 1 ? "🔥 EXTREME" : s.priority === 2 ? "⭐ MAJOR" : "✅ NORMAL"}
📈 *RSI:* ${s.rsi.toFixed(2)} (${s.rsiTrend})
⚡ *Vol Surge:* ${s.volSpike}
📊 *24h Change:* ${s.change}%
🪙 *Coin:* #${s.symbol} | ⏰ *TF:* ${s.timeframe}
--------------------------
🔗 [Open Binance Chart](${s.url})`;
            
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            await new Promise(res => setTimeout(res, 500));
        }

        const longCount = allSignals.filter(s => s.side.includes("LONG")).length;
        const shortCount = allSignals.filter(s => s.side.includes("SHORT")).length;

        await bot.sendMessage(chatId, `✅ *Scan Report Summary*\nTotal Signals: ${allSignals.length}\n🟢 Longs: ${longCount} | 🔴 Shorts: ${shortCount}`);
    } catch (error) { console.error(error.message); }
}

run();
