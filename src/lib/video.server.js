import OpenAI from "openai";

// AI Gateway video client (no provider key: bills to the app's integration credits).
export const gatewayVideos = (base44) => {
  const { baseURL, token, headers } = base44.asServiceRole.aiGateway.connection();
  return new OpenAI({ baseURL, apiKey: token, defaultHeaders: headers }).videos;
};