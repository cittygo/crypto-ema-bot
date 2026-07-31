import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

// Using Bitget as it supports cloud server IPs (unlike Binance)
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
            // Condition: USDT pair, Price < $10, 24h Volume > $1M
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        // Sort by volume and pick TOP 100 coins
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 100); 
    } catch (e) { return []; }
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

        if (!lastEma20 || !lastRsi) return;

        let side = "";
        let emoji = "";
        let entryQuality = "";

        // Strategy: EMA 20 + RSI Filter
        if (lastPrice > lastEma20) {
            if (lastRsi > 70) return; // Avoid Overbought
            side = "LONG Opportunity";
            emoji = "🟢";
            if (lastRsi >= 30 && lastRsi <= 45) entryQuality = "🔥 BEST LONG ENTRY (RSI 30-45)";
        } 
        else if (lastPrice < lastEma20) {
            if (lastRsi < 30) return; // Avoid Oversold
            side = "SHORT Opportunity";
            emoji = "🔴";
            if (lastRsi >= 55 && lastRsi <= 70) entryQuality = "🔥 BEST SHORT ENTRY (RSI 55-70)";
        }

        if (side) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${side}*
${entryQuality ? entryQuality + '\n' : ''}--------------------------
🪙 *Coin:* #${baseAsset}
⏰ *TF:* ${timeframe} | 💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi.toFixed(2)} | 📉 *EMA20:* ${lastEma20.toFixed(4)}
--------------------------
🔗 [Open Binance Chart](${binanceChartUrl})
            `;
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    } catch (e) {}
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        if (coins.length === 0) return;

        await bot.sendMessage(chatId, `🔍 *Scanner Started*\nScanning *${coins.length}* coins (Top Vol)\nTimeframes: ${timeframes.join(', ')}`, { parse_mode: 'Markdown' });

        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(res => setTimeout(res, 400));
            }
        }
        await bot.sendMessage(chatId, "✅ *Scan Completed.*");
    } catch (error) { console.error(error.message); }
}

run();
