import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

const timeframes = ['15m', '1h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            // Filter: USDT Perp and Volume > 1M
            if (symbol.endsWith('USDT') && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 100); 
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 60) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        // Indicators Calculation
        const ema20Arr = EMA.calculate({ period: 20, values: closePrices });
        const ema50Arr = EMA.calculate({ period: 50, values: closePrices });
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });

        const lastEma20 = ema20Arr[ema20Arr.length - 1];
        const prevEma20 = ema20Arr[ema20Arr.length - 2];
        const lastEma50 = ema50Arr[ema50Arr.length - 1];
        const lastRsi = rsiArr[rsiArr.length - 1];

        if (!lastEma20 || !lastRsi) return false;

        let signalType = ""; // BUY or SELL
        let strength = "Normal"; // Normal or Strong
        let emoji = "";

        // --- BUY LOGIC ---
        // 1. RSI 20-30 (Independent Signal)
        if (lastRsi >= 20 && lastRsi <= 30) {
            signalType = "LONG Opportunity";
            emoji = "🟢";
            strength = "High (Oversold RSI)";
        }
        // 2. Combined EMA + RSI Buy Logic
        if (lastPrice > lastEma20 && lastRsi >= 20 && lastRsi <= 35) {
            signalType = "LONG Opportunity";
            emoji = "🟢";
            strength = "Very Strong (EMA Cross + Low RSI)";
        }

        // --- SELL LOGIC ---
        // 1. RSI 70-100 (Independent Signal)
        if (lastRsi >= 70 && lastRsi <= 100) {
            signalType = "SHORT Opportunity";
            emoji = "🔴";
            strength = "High (Overbought RSI)";
        }
        // 2. EMA Decreasing check for Sell
        if (lastRsi >= 70 && lastEma20 < prevEma20) {
            signalType = "SHORT Opportunity";
            emoji = "🔴";
            strength = "Extreme Strong (RSI High + EMA Decreasing)";
        }

        if (signalType) {
            const base = symbol.split('/')[0];
            const url = `https://www.tradingview.com/chart/?symbol=BINANCE:${base}USDT.P`;
            const message = `
${emoji} *${signalType}*
--------------------------
🔥 *Strength:* ${strength}
🪙 *Coin:* #${base}
⏰ *TF:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi.toFixed(2)}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
📉 *EMA 50:* ${lastEma50.toFixed(4)}
--------------------------
🔗 [Open Binance Chart](${url})`;
            
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return true;
        }
    } catch (e) {}
    return false;
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        let totalSignals = 0;

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 400));
            }
        }
        
        const statusMsg = `✅ Scan Finished.\nTotal High-Quality Signals: ${totalSignals}`;
        await bot.sendMessage(chatId, statusMsg);
    } catch (error) {
        console.error("Run Error:", error.message);
    }
}

run();
