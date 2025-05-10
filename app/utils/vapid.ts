import { env } from "./dotenv";
import webPush from "web-push";

const webpush = webPush.setVapidDetails(
  "mailto:costaantonio883@gmail.com",
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export {
    webpush
}