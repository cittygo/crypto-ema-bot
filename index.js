import ccxt from 'ccxt';
import pkg from 'technicalindicators';
const { EMA, RSI } = pkg;
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

// Using Bitget swap for data (Best for GitHub Actions)
const exchange = new ccxt.bitget({
    'options': { 'defaultType': 'swap' },
    'enableRateLimit': true
});

// Timeframes: 15m, 2h, 4h, 1d, 1w
const timeframes = ['15m', '2h', '4h', '1d', '1w'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        let filteredSymbols = [];
        
        for (const symbol in tickers) {
            const ticker = tickers[ticker];
            // Filter: USDT Perp, Price < 10 USDT, Volume > 1M
            if (symbol.endsWith('USDT') && ticker.last < 10 && ticker.quoteVolume > 1000000) {
                filteredSymbols.push(symbol);
            }
        }
        // Sort by volume and get top 100
        filteredSymbols.sort((a, b) => tickers[b].quoteVolume - tickers[a].quoteVolume);
        return filteredSymbols.slice(0, 100); 
    } catch (e) {
        return [];
    }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        if (candles.length < 60) return false;

        const closePrices = candles.map(c => c[4]);
        const lastPrice = closePrices[closePrices.length - 1];

        const ema20Arr = EMA.calculate({ period: 20, values: closePrices });
        const ema50Arr = EMA.calculate({ period: 50, values: closePrices });
        const rsiArr = RSI.calculate({ period: 14, values: closePrices });

        const lastEma20 = ema20Arr[ema20Arr.length - 1];
        const prevEma20 = ema20Arr[ema20Arr.length - 2];
        const lastEma50 = ema50Arr[ema50Arr.length - 1];
        const lastRsi = rsiArr[rsiArr.length - 1];

        if (!lastEma20 || !lastRsi) return false;

        let signalType = ""; 
        let strength = "Normal"; 
        let emoji = "";

        // LONG (BUY) Logic: RSI 10-30
        if (lastRsi >= 10 && lastRsi <= 30) {
            signalType = "LONG Opportunity";
            emoji = "🟢";
            strength = "Extreme (RSI 10-30)";
        }
        if (lastPrice > lastEma20 && lastRsi >= 10 && lastRsi <= 35) {
            signalType = "LONG Opportunity";
            emoji = "🟢";
            strength = "Super Strong (EMA Support)";
        }

        // SHORT (SELL) Logic: RSI 70-100
        if (lastRsi >= 70 && lastRsi <= 100) {
            signalType = "SHORT Opportunity";
            emoji = "🔴";
            strength = "High (Overbought RSI)";
        }
        if (lastRsi >= 70 && lastEma20 < prevEma20) {
            signalType = "SHORT Opportunity";
            emoji = "🔴";
            strength = "Maximum Strength (EMA Falling)";
        }

        if (signalType) {
            const baseAsset = symbol.split('/')[0]; 
            const binanceChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT.P`;
            
            const message = `
${emoji} *${signalType}*
--------------------------
🔥 *Strength:* ${strength}
🪙 *Coin:* #${baseAsset}
⏰ *TF:* ${timeframe}
💰 *Price:* ${lastPrice}
📊 *RSI:* ${lastRsi.toFixed(2)}
📉 *EMA 20:* ${lastEma20.toFixed(4)}
📉 *EMA 50:* ${lastEma50.toFixed(4)}
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

        for (const tf of timeframes) {
            for (const coin of coins) {
                const signalFound = await analyzeCoin(coin, tf);
                if (signalFound) totalSignals++;
                await new Promise(res => setTimeout(res, 450));
            }
        }
        
        const statusMsg = totalSignals === 0 
            ? "✅ Scan Finished: Price < $10 | No signals found." 
            : `✅ Scan Finished: Found ${totalSignals} signals.`;
        await bot.sendMessage(chatId, statusMsg);
    } catch (error) {
        console.error("Error:", error.message);
    }
}

run();
