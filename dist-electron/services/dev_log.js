/** Default: silent. Set DEV_LOG=1 to enable dev console.log output */
export const silent = process.env.DEV_LOG !== '1';
export const devLog = (...a) => { if (!silent)
    console.log(...a); };
