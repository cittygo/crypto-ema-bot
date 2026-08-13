import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

// We use Bitget to fetch data (By-passing Binance GitHub IP block)
const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

const timeframes = ['4h', '1d', '1w'];

// List of Big coins to always include regardless of price
const bigCoins = ['BTC/USDT', 'BNB/USDT', 'SOL/USDT', 'ETH/USDT'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const baseSymbol = symbol.split(':')[0]; // Get standard symbol like BTC/USDT

            // logic: (Price < 10 USDT) OR (Is one of the Big 4 Coins)
            const isBigCoin = bigCoins.includes(baseSymbol);
            const isCheapCoin = ticker.last < 10 && symbol.endsWith('USDT');

            if (isBigCoin || isCheapCoin) {
                if (ticker.quoteVolume > 1000000) { // Only active coins with > 1M volume
                    filteredSymbols.push(symbol);
                }
            }
        }
        
        // Sorting by volume and picking TOP 350 to stay within limits
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 350); 
    } catch (e) {
        console.error("Filter Error:", e.message);
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

        // RSI Rules: 10-30 (LONG) | 70-100 (SHORT)
        if (lastRsi >= 10 && lastRsi <= 30) {
            side = "RSI LONG Opportunity";
            emoji = "🟢";
        } 
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
🔔 *Target:* ${bigCoins.includes(symbol.split(':')[0]) ? "🔥 MAJOR COIN" : "💎 CHEAP COIN"}
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
        
        await bot.sendMessage(chatId, `🔍 *Market Scanner Started*\nFilter: Price < $10 + (BTC, ETH, SOL, BNB)\nScanning ${coins.length} coins...`);

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 450));
            }
        }
        await bot.sendMessage(chatId, `✅ Scan Finished. RSI Signals: ${totalSignals}`);
    } catch (error) { console.error("Run error:", error.message); }
}

run();
