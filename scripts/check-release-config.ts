import { validateReleaseConfig } from "./release-config";
validateReleaseConfig(process.env);
console.log("Release project configuration validated.");
