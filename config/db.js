const mongoose = require('mongoose');
const logger = require('../utils/logger');
const VJCollectionSchema = require('../models/File'); // Rename file or keep as is

const connections = [];

const connectDBs = async () => {
  const uris = process.env.MONGODB_URIS.split(',').map(uri => uri.trim());
  
  for (const uri of uris) {
    try {
      const conn = mongoose.createConnection(uri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 3000,
        socketTimeoutMS: 5000
      });
      
      conn.on('error', (err) => logger.error(`DB ${uri} error:`, err));
      conn.once('open', () => logger.info(`Connected to ${uri}`));
      
      connections.push(conn);
    } catch (err) {
      logger.error(`Failed to connect to ${uri}:`, err);
    }
  }
  
  if (connections.length === 0) {
    throw new Error('No database connections established');
  }

  const MetadataSchema = require('../models/Metadata');
  
  // Register model on all connections with explicit collection name
  connections.forEach(conn => {
    conn.model('VJFile', VJCollectionSchema, 'vjcollection');
    conn.model('Metadata', MetadataSchema, 'metadata');
  });

  
  logger.info(`Connected to ${connections.length} database(s)`);
};

const getConnections = () => connections;

module.exports = { connectDBs, getConnections };