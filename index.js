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

// Timeframes updated: 4h, 1d, 1w (15m and 1h removed)
const timeframes = ['4h', '1d', '1w'];

const majorCoins = ['BTC/USDT', 'BNB/USDT', 'SOL/USDT', 'ETH/USDT'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const baseSymbol = symbol.split(':')[0];

            const isMajor = majorCoins.includes(baseSymbol);
            const isCheap = ticker.last < 10 && symbol.endsWith('USDT');

            // Volume filter set to 100k for earlier signals
            if (isMajor || isCheap) {
                if (ticker.quoteVolume > 100000) { 
                    filteredSymbols.push(symbol);
                }
            }
        }
        
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 350); 
    } catch (e) {
        return [];
    }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        const rsiArr = RSI.calculate({ period: 14, values: closePrices });
        const lastRsi = rsiArr[rsiArr.length - 1];

        if (!lastRsi) return false;

        let side = "";
        let emoji = "";
        let signalStrength = "Standard";

        // RSI Strategy: 10-30 for Long | 70-100 for Short
        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "LONG Opportunity";
            emoji = "🟢";
            if (lastRsi <= 20) signalStrength = "Extremely Oversold (High Potential)";
        } 
        else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "SHORT Opportunity";
            emoji = "🔴";
            if (lastRsi >= 85) signalStrength = "Extremely Overbought (High Risk)";
        }

        if (side) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
📊 *Strength:* ${signalStrength}
🪙 *Coin:* #${baseAsset}
⏰ *Timeframe:* ${timeframe}
💰 *Price:* ${lastPrice}
📈 *RSI:* ${lastRsi.toFixed(2)}
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
        
        await bot.sendMessage(chatId, `🔍 *Market Scanner Started*\nTarget: Price < $10 + Majors\nVolume > 100K | Timeframes: 4h, 1d, 1w\nCoins found: ${coins.length}`);

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) {
                    await new Promise(res => setTimeout(res, 500));
                }
            }
        }
        await bot.sendMessage(chatId, `✅ Scan finished.`);
    } catch (error) { 
        console.error("Scanner Error: ", error.message); 
    }
}

run();
