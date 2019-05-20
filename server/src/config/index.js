import dotenv from 'dotenv';
dotenv.config();
// tslint:disable-next-line:no-var-requires
const vcapServices = require('vcap_services');

const ANALYSIS_DB = 'analysis_db';

export const ENV = {
  dev: 'development',
  prod: 'production',
  test: 'testing'
};

let config = {
  environment: process.env.NODE_ENV || ENV.dev,
  port: process.env.PORT || 3000,
  logging: process.env.LOGGING,
  log_level: process.env.LOGLEVEL,
  cloudant_username: process.env.CLOUDANT_USERNAME,
  cloudant_password: process.env.CLOUDANT_PASSWORD,
  cloudant_db: process.env.CLOUDANT_ANALYSIS_DB_NAME,
  listenFor: process.env.TWITTER_LISTEN_FOR,
  listenTo: process.env.TWITTER_LISTEN_TO,
  filterContaining: process.env.TWITTER_FILTER_CONTAINING,
  filterFrom: process.env.TWITTER_FILTER_FROM,
  processRetweets: Boolean(process.env.TWITTER_PROCESS_RETWEETS),
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_SECRET,
  max_buffer_size: Number(process.env.MAX_BUFFER_SIZE),
  appIdClientId: 'a069d077-0f1d-47ff-a1e5-890631a51a7f',
  appIdOauthServerUrl:
    'https://us-south.appid.cloud.ibm.com/oauth/v4/8c53f71d-04a3-40cb-b279-42ba5645f362',
  appIdProfilesUrl: 'https://us-south.appid.cloud.ibm.com',
  appIdSecret: 'NGNjMTVhZTktZjRjYy00ODVkLWJkMDAtZDQ1ZDhhMmI0ZTdk',
  appIdTenantId: '8c53f71d-04a3-40cb-b279-42ba5645f362',
  appIdVersion: 4,
  appidServiceEndpoint: 'https://us-south.appid.cloud.ibm.com'
};

// merge environment specific config to default config.
// tslint:disable-next-line:no-var-requires
config = { ...config, ...require(`./${config.environment}`).config };

export default config;
