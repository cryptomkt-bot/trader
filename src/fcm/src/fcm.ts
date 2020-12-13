import * as https from "https";

export const sendNotification = async (
  fcmKey: string,
  registration_ids: string[],
  notification: { title: string; body?: string }
): Promise<void> => {
  console.log(`Sending notification to ${JSON.stringify(registration_ids)}`);
  const hostname = "fcm.googleapis.com";
  const data = JSON.stringify({
    registration_ids,
    notification,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: "/fcm/send",
        method: "POST",
        headers: {
          Authorization: `key=${fcmKey}`,
          "Content-Type": "application/json",
          "Content-Length": data.length,
        },
      },
      (res) => {
        const { statusCode } = res;

        if (statusCode && statusCode >= 200 && statusCode < 300) {
          console.log("Notification successfully sent");
          resolve();
        } else {
          console.error("Failed to send notification");
          reject();
        }
      }
    );

    req.on("error", (e) => {
      reject(e);
    });

    req.write(data);

    req.end();
  });
};
