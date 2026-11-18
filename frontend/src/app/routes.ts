export const projectRoute = '/app/{-$profileId}/projects/$projectId';
export const sessionRoute = `${projectRoute}/sessions/$sessionId` as const;
export const diffRoute = `${projectRoute}/diff` as const;
