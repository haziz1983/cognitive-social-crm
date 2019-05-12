import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import config from './config';
import { errorHandler } from './middleware/ErrorHandler';
import { MiddleWare } from './middleware/MiddleWare';
import { AnalysisRoute } from './routes/AnalysisRoute';
import { TweeterRoute } from './routes/TweeterRoute';
import { TweeterListener } from './service/TweeterListener';
import logger from './util/Logger';
import { EnrichmentPipeline } from './util/EnrichmentPipeline';
import { CloudantDAO } from './dao/CloudantDAO';

const appID = require('ibmcloud-appid');
const WebAppStrategy = appID.WebAppStrategy;
const userProfileManager = appID.UserProfileManager;
const UnauthorizedException = appID.UnauthorizedException;
const isLocal = config.isLocal;

const LOGIN_URL = '/ibm/bluemix/appid/login';
const CALLBACK_URL = '/ibm/bluemix/appid/callback';

//Loading appId configurations from config file
const appIdConfig = getLocalConfig();

function getLocalConfig() {
  let appIdConfig = {
    clientId: config.appIdClientId,
    tenantId: config.appIdTenantId,
    secret: config.appIdSecret,
    oauthServerUrl: config.appIdOauthServerUrl,
    profilesUrl: config.appIdProfilesUrl,
    version: 0,
    redirectUri: `http://localhost:${config.port}${CALLBACK_URL}`,
    appidServiceEndpoint: ''
  };

  if (config.appIdVersion) {
    appIdConfig.version = config.appIdVersion;
  }

  if (config.appidServiceEndpoint) {
    appIdConfig.appidServiceEndpoint = config.appidServiceEndpoint;
  }
  return appIdConfig;
}

let tweeterListener;
let cloudantDAO;
const app = express();
appConfig();

const twitOptions = {};
twitOptions.max = -1;

const enrichmentPipeline = EnrichmentPipeline.getInstance();
// app level initialization
const cloudantOptions = {};
cloudantOptions.maxBufferSize = config.max_buffer_size;

cloudantDAO = CloudantDAO.getInstance(cloudantOptions, enrichmentPipeline);
// setup the database once the enrichment pipeline has been initialized.
cloudantDAO
  .setupCloudant()
  .then(() => {
    tweeterListener = TweeterListener.getInstance(
      twitOptions,
      enrichmentPipeline
    );
    // Make sure first user ids are set if LISTEN_TO flag is set.
    tweeterListener
      .init()
      .then(() => {
        tweeterListenerStart();
      })
      .catch(err => {
        logger.error(err);
      });

    routes(enrichmentPipeline, cloudantDAO);
  })
  .catch(error => {
    logger.error(error);
    process.exit(1);
  });

function appConfig() {
  app.use(MiddleWare.appMiddleware(app));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(errorHandler);
  app.use(cors());

  configureSecurity();

  // Setup express application to use express-session middleware
  app.use(
    session({
      secret: '123456',
      resave: true,
      saveUninitialized: true,
      proxy: true,
      cookie: {
        httpOnly: true,
        secure: isLocal
      }
    })
  );

  // Configure express application to use passportjs
  app.use(passport.initialize());
  app.use(passport.session());

  //Initializing App ID WebAppStrategy with the credentials
  //Credentials can be obtained from Service Credentials tab in the App ID Dashboard.
  let webAppStrategy = new WebAppStrategy(appIdConfig);
  passport.use(webAppStrategy);

  // Initialize the user attribute Manager
  userProfileManager.init(appIdConfig);

  // Configure passportjs with user serialization/deserialization. This is required
  // for authenticated session persistence accross HTTP requests. See passportjs docs
  // for additional information http://passportjs.org/docs
  passport.serializeUser(function(user, cb) {
    cb(null, user);
  });

  passport.deserializeUser(function(obj, cb) {
    cb(null, obj);
  });
}

function configureSecurity() {
  app.use(helmet());
  app.use(cookieParser());
  app.use(helmet.noCache());
  app.enable('trust proxy');
}
function tweeterListenerStart() {
  tweeterListener.startListener();
}

function routes(enrichmentPipeline, cloudantDAO) {
  app.use('/tweets', new TweeterRoute(enrichmentPipeline).router);
  app.use(
    '/analysis',
    passport.authenticate(WebAppStrategy.STRATEGY_NAME),
    new AnalysisRoute(cloudantDAO).router
  );

  app.get(
    '/',
    passport.authenticate(WebAppStrategy.STRATEGY_NAME),
    (req, res) => {
      console.log('In root route');
      res.status(200).send({
        message: 'Hello There! Welcome to the Cognitive Social App!'
      });
    }
  );

  // this.app.get(
  //   '/analysis',
  //   passport.authenticate(WebAppStrategy.STRATEGY_NAME),
  //   new AnalysisRoute(cloudantDAO).router
  // );

  // Explicit login endpoint. Will always redirect browser to login widget due to {forceLogin: true}.
  // If forceLogin is set to false redirect to login widget will not occur of already authenticated users.
  app.get(
    LOGIN_URL,
    passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
      successRedirect: '/analysis',
      failureRedirect: LOGIN_URL
    })
  );

  app.get('/logout', function(req, res) {
    WebAppStrategy.logout(req);
    res.redirect('/');
  });

  // Callback to finish the authorization process. Will retrieve access and identity tokens/
  // from AppID service and redirect to either (in below order)
  // 1. the original URL of the request that triggered authentication, as persisted in HTTP session under WebAppStrategy.ORIGINAL_URL key.
  // 2. successRedirect as specified in passport.authenticate(name, {successRedirect: "...."}) invocation
  // 3. application root ("/")
  app.get(
    CALLBACK_URL,
    passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
      failureRedirect: '/error',
      failureFlash: true
    })
  );
}

function storeRefreshTokenInCookie(req, res, next) {
  if (
    req.session[WebAppStrategy.AUTH_CONTEXT] &&
    req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken
  ) {
    const refreshToken = req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken;
    /* An example of storing user's refresh-token in a cookie with expiration of a month */
    res.cookie('refreshToken', refreshToken, {
      maxAge: 1000 * 60 * 60 * 24 * 30 /* 30 days */
    });
  }
  next();
}

function isLoggedIn(req) {
  return req.session[WebAppStrategy.AUTH_CONTEXT];
}

export default app;
