import { sendNotification } from "./fcm";

interface RecordBody {
  tokens: string[];
  notification: {
    title: string;
    body?: string;
  };
}

interface Event {
  Records: {
    Sns: {
      Message: string;
    };
  }[];
}

export const handler = async (event: Event): Promise<void> => {
  const { FCM_KEY } = process.env;

  if (!FCM_KEY) {
    console.error("FCM_KEY environment variable is missing");
    return;
  }

  const { Records } = event;

  const notificationPromises = Records.map((r) => {
    const body: RecordBody = JSON.parse(r.Sns.Message);

    return sendNotification(FCM_KEY, body.tokens, body.notification).catch();
  });

  await Promise.all(notificationPromises);
};
