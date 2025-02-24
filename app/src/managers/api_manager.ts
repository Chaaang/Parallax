import { relative } from 'path';
import { pathToFileURL } from 'url';
import express, {
  json,
  urlencoded,
  Express,
  Router,
  Request,
  Response,
  NextFunction,
} from 'express';
import fetch from 'node-fetch';
import type Bot from '../modules/bot.js';
import { APIMethod } from '../schemas/enums.js';
import type APIRoute from '../structures/api_route.js';
import Manager from '../structures/manager.js';

export default class APIManager extends Manager {
  private expressClient: Express;

  constructor(bot: Bot) {
    super(bot);

    this.expressClient = express()
      .use(json())
      .use(urlencoded({ extended: false }));
  }

  async init() {
    const initTelemetry = this.bot.managers.telemetry.node(this, 'Initialize');

    try {
      let loaded = 0;
      const router = Router();
      const routesPath = this.bot.managers.environment.routesPath();
      const webPath = this.bot.managers.environment.webPath();

      for (const routePath of this.bot.utils.getFiles(routesPath)) {
        if (!routePath.endsWith('.js')) continue;

        const filePath = pathToFileURL(routePath).href;
        const relPath = relative(routesPath, routePath);
        const sections = relPath.replace(/\\/g, '/').split('/');
        const endpoint = `/api/${sections
          .slice(0, sections.length - 1)
          .map(section => {
            if (!section.startsWith('_')) return section;
            return `:${section.substring(1)}`;
          })
          .join('/')}`;

        const { default: Route } = await import(filePath);
        const route = new Route(this.bot) as APIRoute;
        const method = sections[sections.length - 1].split('.')[0].toUpperCase() as APIMethod;

        const middleware = (req: Request, res: Response, next: NextFunction) =>
          route.middleware(req, res, next);
        const exec = (req: Request, res: Response) => route.exec(req, res);

        switch (method) {
          case APIMethod.Get:
            router.get(endpoint, middleware, exec);
            break;
          case APIMethod.Put:
            router.put(endpoint, middleware, exec);
            break;
          case APIMethod.Patch:
            router.patch(endpoint, middleware, exec);
            break;
          case APIMethod.Delete:
            router.delete(endpoint, middleware, exec);
            break;
          default:
            throw new Error(`HTTP ${method} method is not supported. At ${endpoint}.`);
        }

        loaded++;
      }

      this.expressClient.use(router).use(express.static(webPath));
      initTelemetry.logMessage(`A total of ${loaded} routes were loaded`, false);

      this.expressClient.listen(this.bot.managers.environment.port(), () => {
        initTelemetry.logMessage(
          `Server is running on ${this.bot.managers.environment.url()}`,
          false,
        );
      });
    } catch (error) {
      initTelemetry.logError(error);
    }

    await this.keepAlive();
  }

  private async keepAlive() {
    const { environment, telemetry } = this.bot.managers;
    const keepAliveTelemetry = telemetry.node(this, 'Keep Alive');

    try {
      const result = await fetch(`${environment.url()}/api/ping`);
      if (!result.ok) throw new Error('Failed to communicate with the server');

      const data = (await result.json()) as { ping: number };

      keepAliveTelemetry.logMessage(
        `My current ping to the discord server is ${data.ping} ms.`,
        false,
      );
    } catch (error) {
      keepAliveTelemetry.logError(error);
    } finally {
      setTimeout(() => this.keepAlive(), 30000);
    }
  }
}
