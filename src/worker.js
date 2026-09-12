import { TeachingRoomApp } from "./do.js";

export { TeachingRoomApp };

export default {
  async fetch(request, env, ctx) {
    const id = env.APP_DO.idFromName("singleton");
    const stub = env.APP_DO.get(id);
    return stub.fetch(request);
  }
};
