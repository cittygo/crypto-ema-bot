import ccxt from 'ccxt';
import pkg from 'technicalindicators';
// Added ADX indicator
const { RSI, ADX } = pkg;
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

        // Extracting High, Low, Close for ADX & RSI
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
        // Logic: Trend was strong (>25) but is now losing momentum (decreasing)
        const isExhausted = prevAdx > 25 && lastAdx < prevAdx;

        // Volume Spike Detection
        const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVol = volumes[volumes.length - 1];
        const volSpike = currentVol > avgVol * 2; // 2x volume increase

        let side = "", emoji = "", strength = "Standard", priority = 3, adxStatus = "";

        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "LONG Opportunity"; emoji = "🟢";
            if (lastRsi <= 20) { strength = "Extreme Oversold"; priority = 1; }
            // ADX Condition for Long
            adxStatus = isExhausted ? "🔥 SELLERS EXHAUSTED (Sniper Entry)" : "⚠️ Falling Knife (High Risk, Wait)";
        } else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "SHORT Opportunity"; emoji = "🔴";
            if (lastRsi >= 80) { strength = "Extreme Overbought"; priority = 1; }
            // ADX Condition for Short
            adxStatus = isExhausted ? "🔥 BUYERS EXHAUSTED (Sniper Entry)" : "⚠️ Still Pumping (High Risk, Wait)";
        }

        if (side) {
            const base = symbol.split('/')[0];
            if (priority !== 1 && majorCoins.includes(`${base}/USDT`)) priority = 2;

            return {
                symbol: base,
                timeframe,
                price: closePrices[closePrices.length - 1],
                rsi: lastRsi,
                rsiTrend: lastRsi > prevRsi ? "⬆️ Rising" : "⬇️ Falling",
                change: coinObj.change,
                volSpike: volSpike ? "🔥 VOLUME SPIKE!" : "Normal",
                adxStatus: adxStatus, // New ADX Data
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

        await bot.sendMessage(chatId, `🔍 *Professional Scanner v2.0 Started*\nChecking 24h Change, RSI Trend, Vol Spikes & ADX Exhaustion...\nTotal Coins: ${coins.length}`);

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
📊 *Priority:* ${s.priority === 1 ? "🔥 EXTREME" : s.priority === 2 ? "⭐ MAJOR" : "✅ NORMAL"}
📈 *RSI:* ${s.rsi.toFixed(2)} (${s.rsiTrend})
📉 *Strength:* ${s.strength}
⚡ *Vol Surge:* ${s.volSpike}
📊 *24h Change:* ${s.change}%
🪙 *Coin:* #${s.symbol}
⏰ *TF:* ${s.timeframe} | 💰 *Price:* ${s.price}
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
