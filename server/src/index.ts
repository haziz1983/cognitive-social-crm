import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as session from 'express-session';
import * as passport from 'passport';
import * as helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { Request, Response } from 'express';
import config from './config';
import { errorHandler } from './middleware/ErrorHandler';
import { MiddleWare } from './middleware/MiddleWare';
import { AnalysisRoute } from './routes/AnalysisRoute';
import { TweeterRoute } from './routes/TweeterRoute';
import { TwitterOptions, CloudantOptions } from './model/CRMModel';
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

function getLocalConfig(): {} {
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
class App {
  public app!: express.Application;
  private tweeterListener!: TweeterListener;
  // private conversationInitializer!: ConversationInitializer;

  private cloudantDAO!: CloudantDAO;

  constructor() {
    this.app = express();
    this.config();

    const twitOptions: TwitterOptions = {} as TwitterOptions;
    twitOptions.max = -1;

    const enrichmentPipeline: EnrichmentPipeline = EnrichmentPipeline.getInstance();
    // app level initialization
    const cloudantOptions: CloudantOptions = {} as CloudantOptions;
    cloudantOptions.maxBufferSize = config.max_buffer_size;

    this.cloudantDAO = CloudantDAO.getInstance(
      cloudantOptions,
      enrichmentPipeline
    );
    // setup the database once the enrichment pipeline has been initialized.
    this.cloudantDAO
      .setupCloudant()
      .then(() => {
        this.tweeterListener = TweeterListener.getInstance(
          twitOptions,
          enrichmentPipeline
        );
        // Make sure first user ids are set if LISTEN_TO flag is set.
        this.tweeterListener
          .init()
          .then(() => {
            this.tweeterListenerStart();
          })
          .catch(err => {
            logger.error(err);
          });

        this.routes(enrichmentPipeline, this.cloudantDAO);
      })
      .catch(error => {
        logger.error(error);
        process.exit(1);
      });
  }

  private config(): void {
    this.app.use(MiddleWare.appMiddleware(this.app));
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: false }));
    this.app.use(errorHandler);
    this.app.use(cors());

    this.configureSecurity();

    // Setup express application to use express-session middleware
    this.app.use(
      session({
        secret: '123456',
        resave: true,
        saveUninitialized: true,
        proxy: true,
        cookie: {
          httpOnly: true,
          secure: !isLocal
        }
      })
    );

    // Configure express application to use passportjs
    this.app.use(passport.initialize());
    this.app.use(passport.session());
  }

  private configureSecurity(): void {
    this.app.use(helmet());
    this.app.use(cookieParser());
    this.app.use(helmet.noCache());
    this.app.enable('trust proxy');
  }
  private tweeterListenerStart(): void {
    this.tweeterListener.startListener();
  }

  private routes(
    enrichmentPipeline: EnrichmentPipeline,
    cloudantDAO: CloudantDAO
  ): void {
    this.app.use('/tweets', new TweeterRoute(enrichmentPipeline).router);
    this.app.use(
      '/analysis',
      //passport.authenticate(WebAppStrategy.STRATEGY_NAME),
      new AnalysisRoute(cloudantDAO).router
    );

    // this.app.get(
    //   '/',
    //   //passport.authenticate(WebAppStrategy.STRATEGY_NAME),
    //   (req: Request, res: Response) => {
    //     res.status(200).send({
    //       message: 'Hello There! Welcome to the Cognitive Social App!'
    //     });
    //   }
    // );

    // this.app.get(
    //   '/analysis',
    //   passport.authenticate(WebAppStrategy.STRATEGY_NAME),
    //   new AnalysisRoute(cloudantDAO).router
    // );

    // Explicit login endpoint. Will always redirect browser to login widget due to {forceLogin: true}.
    // If forceLogin is set to false redirect to login widget will not occur of already authenticated users.
    this.app.get(
      LOGIN_URL,
      passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
        successRedirect: '/analysis',
        failureRedirect: LOGIN_URL
      })
    );

    this.app.get('/logout', function(req, res) {
      WebAppStrategy.logout(req);
      res.redirect('/');
    });

    // Callback to finish the authorization process. Will retrieve access and identity tokens/
    // from AppID service and redirect to either (in below order)
    // 1. the original URL of the request that triggered authentication, as persisted in HTTP session under WebAppStrategy.ORIGINAL_URL key.
    // 2. successRedirect as specified in passport.authenticate(name, {successRedirect: "...."}) invocation
    // 3. application root ("/")
    this.app.get(
      CALLBACK_URL,
      passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
        failureRedirect: '/error',
        failureFlash: true
      })
    );
  }

  // private storeRefreshTokenInCookie(req: any, res: any, next: any): void {
  //   if (
  //     req.session[WebAppStrategy.AUTH_CONTEXT] &&
  //     req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken
  //   ) {
  //     const refreshToken =
  //       req.session[WebAppStrategy.AUTH_CONTEXT].refreshToken;
  //     /* An example of storing user's refresh-token in a cookie with expiration of a month */
  //     res.cookie('refreshToken', refreshToken, {
  //       maxAge: 1000 * 60 * 60 * 24 * 30 /* 30 days */
  //     });
  //   }
  //   next();
  // }

  // private isLoggedIn(req: any) {
  //   return req.session[WebAppStrategy.AUTH_CONTEXT];
  // }
}

export default new App().app;
