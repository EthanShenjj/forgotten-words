/** @type {import('next').NextConfig} */
const repo = "forgotten-words";

const nextConfig = {
  output: "export",
  basePath: `/${repo}`,
  assetPrefix: `/${repo}/`,
};

module.exports = nextConfig;
