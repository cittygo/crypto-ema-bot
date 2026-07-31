import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

// Using Bitget for data (bypass GitHub IP block)
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
            // Filter: USDT Perpetual, Price < 10, Volume > 1M
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 60); 
    } catch (e) {
        return [];
    }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 50) return;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        const ema20Array = EMA.calculate({ period: 20, values: closePrices });
        const lastEma20 = ema20Array[ema20Array.length - 1];

        const rsiArray = RSI.calculate({ period: 14, values: closePrices });
        const lastRsi = rsiArray[rsiArray.length - 1];

        if (!lastEma20) return;

        let side = "";
        let emoji = "";

        if (lastPrice > lastEma20) {
            side = "LONG Opportunity";
            emoji = "🟢";
        } else if (lastPrice < lastEma20) {
            side = "SHORT Opportunity";
            emoji = "🔴";
        }

        if (side) {
            // FIX: Get base name only (e.g., from EPIC/USDT:USDT take EPIC)
            const baseAsset = symbol.split('/')[0]; 
            // Correct Format: BINANCE:EPICUSDT.P
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
--------------------------
🪙 *Coin:* #${baseAsset}
⏰ *Timeframe:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi ? lastRsi.toFixed(2) : 'N/A'}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
--------------------------
🔗 [Open Chart on Binance](${binanceChartUrl})
            `;
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    } catch (e) {}
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        const totalCoins = coins.length;

        if (totalCoins === 0) return;

        await bot.sendMessage(chatId, `🔍 *Market Scanner Started*\nChecking *${totalCoins}* coins\nTargeting Binance Charts...`, { parse_mode: 'Markdown' });

        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(res => setTimeout(res, 400));
            }
        }
        
        await bot.sendMessage(chatId, "✅ *Scan Completed Successfully.*");
    } catch (error) {
        console.error("Run Error:", error.message);
    }
}

run();
