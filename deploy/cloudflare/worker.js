// Cloudflare Worker 入口：把请求转发到运行教学管理系统的容器。
import { Container } from "cloudflare:containers";

export class TeachingRoomContainer extends Container {
  defaultPort = 3000;
}

export default {
  async fetch(request, env) {
    const id = env.CONTAINER.idFromName("teachingroom");
    const container = env.CONTAINER.get(id);
    return await container.fetch(request);
  }
};
