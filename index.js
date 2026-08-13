import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

// Timeframes: 4h, 1d, 1w
const timeframes = [ '4h', '1d', '1w'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            // Condition: USDT pair, Price < $10, 24h Volume > $1M
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        // Sorting by volume and picking TOP 300 coins
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 300); 
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        // Calculating RSI 14
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });
        const lastRsi = rsiArr[rsiArr.length - 1];

        if (!lastRsi) return false;

        let side = "";
        let emoji = "";

        // --- ONLY RSI RULES ---
        // RSI 10 to 30: LONG Opportunity
        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "RSI LONG Opportunity";
            emoji = "🟢";
        } 
        // RSI 70 to 100: SHORT Opportunity
        else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "RSI SHORT Opportunity";
            emoji = "🔴";
        }

        if (side) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
🔔 *Trigger:* RSI Strategy
🪙 *Coin:* #${baseAsset}
⏰ *TF:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi.toFixed(2)}
--------------------------
🔗 [Open Binance Chart](${binanceChartUrl})`;
            
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
        
        await bot.sendMessage(chatId, `🔍 *RSI Scanner Started (Top 300)*\nPrice < $10 |  4h, 1d, 1w\nScanning 300 coins...`);

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 450));
            }
        }
        await bot.sendMessage(chatId, `✅ Scan Finished. RSI Signals: ${totalSignals}`);
    } catch (error) { console.error(error.message); }
}

run();
