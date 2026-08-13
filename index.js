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

// Early Entry-க்காக 15m மற்றும் 1h மீண்டும் சேர்க்கப்பட்டுள்ளது
const timeframes = ['15m', '1h', '4h', '1d', '1w'];

const bigCoins = ['BTC/USDT', 'BNB/USDT', 'SOL/USDT', 'ETH/USDT'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const baseSymbol = symbol.split(':')[0];

            const isBigCoin = bigCoins.includes(baseSymbol);
            const isCheapCoin = ticker.last < 10 && symbol.endsWith('USDT');

            // வால்யூம் லிமிட் 1M-ல் இருந்து 100K (100,000) ஆகக் குறைக்கப்பட்டுள்ளது
            if (isBigCoin || isCheapCoin) {
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
        let quality = "Normal";

        // RSI 10-30: LONG | 70-100: SHORT
        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "EARLY LONG Opportunity";
            emoji = "🟢";
            if (lastRsi <= 20) quality = "🔥 EXTREME BOTTOM (RSI < 20)";
        } 
        else if (lastRsi >= 70 && lastRsi <= 100) {
            side = "EARLY SHORT Opportunity";
            emoji = "🔴";
            if (lastRsi >= 85) quality = "🔥 EXTREME TOP (RSI > 85)";
        }

        if (side) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
⚡ *Entry Quality:* ${quality}
🪙 *Coin:* #${baseAsset}
⏰ *TF:* ${timeframes.includes(timeframe) ? timeframe : timeframe}
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
        
        // Start Message
        await bot.sendMessage(chatId, `🚀 *Early Entry Scanner Started*\nFilter: Price < $10 | Vol > 100K\nScanning ${coins.length} coins across 5 timeframes...`);

        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(res => setTimeout(res, 400));
            }
        }
        await bot.sendMessage(chatId, `✅ Scan Finished.`);
    } catch (error) { console.error(error.message); }
}

run();
