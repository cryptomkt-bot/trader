# CryptoMKT Bot

<img src="https://cryptomktbot.netlify.com/img/icons/android-chrome-512x512.png" label="icon" width="256px">

> Serverless trading bot for [CryptoMarket](https://www.cryptomkt.com) running in [AWS](https://aws.amazon.com).

## Services
- **trader:** Trading bot
- **auth:** Authentication service
- **cryptomkt:** CryptoMarket proxy service
- **fcm:** FCM service

## Build
```bash
# cd into service
cd src/<service>

# install dependencies
yarn install

# build for production
yarn run build
```

## Deployment
```bash
yarn cdk deploy --parameters fcmKey=<yourFcmKey>
```