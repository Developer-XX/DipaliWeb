const { createClient } = require('redis');
const logger = require('../utils/logger');

const redisHost = 'redis-17798.c9.us-east-1-2.ec2.cloud.redislabs.com';
const redisPort = 17798;
const redisPassword = process.env.REDIS_PASSWORD || 'ndpNtjNHlWdcTHaSepQvjlOQsfwtmlYX';
const redisUrl = `redis://default:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`;

const client = createClient({ url: redisUrl });

client.on('error', (err) => logger.error('Redis Client Error', err));
client.on('connect', () => logger.info('Redis connected'));

const connectRedis = async () => {
  await client.connect();
};

module.exports = { client, connectRedis };