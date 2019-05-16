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
import cfEnv from 'cfenv';
import express_enforces_ssl from 'express-enforces-ssl';

const appID = require('ibmcloud-appid');
const WebAppStrategy = appID.WebAppStrategy;
const userProfileManager = appID.UserProfileManager;
const isLocal = cfEnv.getAppEnv().isLocal;

const LOGIN_URL = '/auth/login';
const CALLBACK_URL = '/ibm/bluemix/appid/callback';

const UI_BASE_URL = config.uiBaseUrl;

//Loading appId configurations from config file
const appIdConfig = getLocalConfig();

const app = express();
app.use(MiddleWare.appMiddleware(app));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(errorHandler);
app.use(cors({ credentials: true, origin: UI_BASE_URL }));
configureSecurity();

//Setup express application to use express-session middleware
// Must be configured with proper session storage for production
// environments. See https://github.com/expressjs/session for
// additional documentation
app.use(
  session({
    secret: 'keyboardcat',
    resave: true,
    saveUninitialized: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: !isLocal,
      maxAge: 600000000
    }
  })
);

// Configure express application to use passportjs
app.use(passport.initialize());
app.use(passport.session());

let webAppStrategy = new WebAppStrategy(appIdConfig);
passport.use(webAppStrategy);

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

function getLocalConfig() {
  if (!config.isLocal) {
    return;
  }
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

function configureSecurity() {
  app.use(helmet());
  app.use(cookieParser());
  app.use(helmet.noCache());
  app.enable('trust proxy');
  if (!isLocal) {
    app.use(express_enforces_ssl());
  }
}

function tweeterListenerStart() {
  tweeterListener.startListener();
}

function isLoggedIn(req, res, next) {
  console.log(JSON.stringify(req.session));
  if (req.session[WebAppStrategy.AUTH_CONTEXT]) {
    next();
  } else {
    res.redirect(LOGIN_URL);
  }
}

function routes(enrichmentPipeline, cloudantDAO) {
  //CORS middleware
  // var corsMiddleware = function(req, res, next) {
  //   res.header('Access-Control-Allow-Origin', '*'); //replace localhost with actual host
  //   res.header(
  //     'Access-Control-Allow-Methods',
  //     'OPTIONS, GET, PUT, PATCH, POST, DELETE'
  //   );
  //   res.header(
  //     'Access-Control-Allow-Headers',
  //     'Content-Type, X-Requested-With, Authorization'
  //   );

  //   next();
  // };
  // app.use(corsMiddleware);

  // app.use('/api/*', isLoggedIn);

  app.use('/tweets', isLoggedIn, new TweeterRoute(enrichmentPipeline).router);
  app.use('/analysis', isLoggedIn, new AnalysisRoute(cloudantDAO).router);

  app.use('/analysis/sentimentOverTime', isLoggedIn);
  app.use('/analysis/sentimentTrend', isLoggedIn);
  app.use('/analysis/sentimentSummary', isLoggedIn);
  app.use('/analysis/keywordsSummary', isLoggedIn);
  app.use('/analysis/emotionalToneOvertime', isLoggedIn);
  app.use('/analysis/listByPostDate', isLoggedIn);
  app.use('/tweets/status', isLoggedIn);
  // Protected area. If current user is not authenticated - redirect to the login widget will be returned.
  // In case user is authenticated - a page with current user information will be returned.
  app.get(
    LOGIN_URL,
    passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
      successRedirect: UI_BASE_URL,
      forceLogin: true
    })
  );

  app.get('/auth/logout', function(req, res, next) {
    WebAppStrategy.logout(req);
    res.redirect(UI_BASE_URL);
  });

  app.get('/token', function(req, res) {
    //return the token data
    res.render('token', {
      tokens: JSON.stringify(req.session[WebAppStrategy.AUTH_CONTEXT])
    });
  });

  app.get('/auth/logged', (req, res) => {
    let loggedInAs = {};
    if (req.session[WebAppStrategy.AUTH_CONTEXT]) {
      loggedInAs['name'] = req.user.name;
      loggedInAs['email'] = req.user.email;
    }

    res.send({
      logged: req.session[WebAppStrategy.AUTH_CONTEXT] ? true : false,
      loggedInAs: loggedInAs
    });
  });

  // Callback to finish the authorization process. Will retrieve access and identity tokens/
  // from AppID service and redirect to either (in below order)
  // 1. the original URL of the request that triggered authentication, as persisted in HTTP session under WebAppStrategy.ORIGINAL_URL key.
  // 2. successRedirect as specified in passport.authenticate(name, {successRedirect: "...."}) invocation
  // 3. application root ("/")
  app.get(
    CALLBACK_URL,
    passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
      allowAnonymousLogin: true
    })
  );

  function storeRefreshTokenInCookie(req, res, next) {
    if (
      req.session[WebAppStrategy.AUTH_CONTEXT] &&
      req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken
    ) {
      const refreshToken =
        req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken;
      /* An example of storing user's refresh-token in a cookie with expiration of a month */
      res.cookie('refreshToken', refreshToken, {
        maxAge: 1000 * 60 * 60 * 24 * 30 /* 30 days */
      });
    }
    next();
  }
}
export default app;
