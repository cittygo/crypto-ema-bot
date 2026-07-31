const ccxt = require('ccxt');
const { EMA } = require('technicalindicators');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new TelegramBot(token);

const exchange = new ccxt.binance({
    'options': { 'defaultType': 'future' },
    'enableRateLimit': true
});

const timeframes = ['2h', '4h', '1d'];

async function getFilteredPerpPairs() {
    try {
        const tickers = await exchange.fetchTickers();
        const markets = await exchange.loadMarkets();
        let filteredSymbols = [];
        for (const symbol in tickers) {
            const ticker = tickers[symbol];
            const market = markets[symbol];
            if (symbol.endsWith('/USDT') && market.type === 'swap' && ticker.last < 10 && market.active) {
                filteredSymbols.push(symbol);
            }
        }
        return filteredSymbols;
    } catch (e) { return []; }
}

async function analyzeCoin(symbol, timeframe) {
    try {
        const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
        const closePrices = candles.map(c => c[4]);
        const currentPrice = closePrices[closePrices.length - 1];
        const ema20 = EMA.calculate({ period: 20, values: closePrices }).pop();
        const ema50 = EMA.calculate({ period: 50, values: closePrices }).pop();

        if (currentPrice < ema20 && currentPrice < ema50) {
            await bot.sendMessage(chatId, `🔻 BUY: ${symbol} (${timeframe})\nPrice: ${currentPrice}`);
        } else if (currentPrice > ema20 && currentPrice > ema50) {
            await bot.sendMessage(chatId, `✅ SELL: ${symbol} (${timeframe})\nPrice: ${currentPrice}`);
        }
    } catch (e) {}
}

async function run() {
    const coins = await getFilteredPerpPairs();
    for (const tf of timeframes) {
        for (const coin of coins) {
            await analyzeCoin(coin, tf);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}
run();
