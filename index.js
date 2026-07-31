import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.binance({
    'options': { 'defaultType': 'swap' }, // Changed from 'future' to 'swap' for Perpetuals
    'enableRateLimit': true
});

const timeframes = ['15m', '1h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        console.log("Loading Binance Markets...");
        const markets = await exchange.loadMarkets();
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        console.log(`Total symbols found on Binance: ${Object.keys(tickers).length}`);

        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const market = markets[symbol];
            
            // Broad Filter: 
            // 1. USDT based
            // 2. Price < 10
            // 3. Volume > 1M (Reduced from 5M to find more coins)
            if (symbol.includes('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                if (market && (market.swap || market.type === 'swap')) {
                    filteredSymbols.push(symbol);
                }
            }
        }
        
        // Sorting by Volume (High to Low) and picking top 50
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 50); 
    } catch (e) {
        console.error("Filter Error:", e.message);
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
            // Clean the symbol name for display (e.g., BTC/USDT:USDT -> BTCUSDT)
            const cleanSymbol = symbol.split(':')[0].replace('/', '');
            const chartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${cleanSymbol}P`;
            
            const message = `
${emoji} *${side}*
--------------------------
🪙 *Coin:* #${cleanSymbol.replace('USDT', '')}
⏰ *Timeframe:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi ? lastRsi.toFixed(2) : 'N/A'}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
--------------------------
🔗 [Open Chart](${chartUrl})
            `;
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        // Silently handle errors for specific symbols
    }
}

async function run() {
    try {
        const coins = await getFilteredPerpPairs();
        const totalCoins = coins.length;

        if (totalCoins === 0) {
            console.log("No coins found matching criteria.");
            await bot.sendMessage(chatId, "⚠️ No coins found matching the criteria. Bot is still running but found 0 matches.");
            return;
        }

        await bot.sendMessage(chatId, `🔍 *Scanner Started*\nScanning *${totalCoins}* Active coins\n(Price < $10 | Vol > 1M)\nChecking timeframes...`, { parse_mode: 'Markdown' });

        for (const tf of timeframes) {
            for (const coin of coins) {
                await analyzeCoin(coin, tf);
                await new Promise(res => setTimeout(res, 500));
            }
        }
        
        await bot.sendMessage(chatId, "✅ *Scan Completed Successfully.*", { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Critical Error:", error.message);
    }
}

run();
