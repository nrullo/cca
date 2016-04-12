var path = require('path'),
    rootPath = path.normalize(__dirname + '/..'),
    env = process.env.NODE_ENV || 'development';

var config = {
  development: {
    root: rootPath,
    app: {
      name: 'cca'
    },
    port: process.env.PORT || 3000,
    db: 'mongodb://localhost/cca-development'
  },

  test: {
    root: rootPath,
    app: {
      name: 'cca'
    },
    port: process.env.PORT || 3000,
    db: 'mongodb://localhost/cca-test'
  },

  production: {
    root: rootPath,
    app: {
      name: 'cca'
    },
    port: process.env.PORT || 3000,
    db: 'mongodb://localhost/cca-production'
  }
};

module.exports = config[env];
