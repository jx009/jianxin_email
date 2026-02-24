const API_PATHS = [
    "/api/",
    "/open_api/",
    "/user_api/",
    "/admin/",
    "/telegram/",
    "/external/",
];

export async function onRequest(context) {
    const reqPath = new URL(context.request.url).pathname;
    const directInboxMatch = reqPath.match(/^\/(?:[a-z]{2}\/)?admin\/address\/[^/]+\/?$/i);
    const accept = context.request.headers.get("accept") || "";
    const isHtmlNavigation = accept.includes("text/html");
    if (directInboxMatch && isHtmlNavigation) {
        return await context.next();
    }
    if (API_PATHS.map(path => reqPath.startsWith(path)).some(Boolean)) {
        return context.env.BACKEND.fetch(context.request);
    }
    return await context.next();
}
