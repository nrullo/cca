var express = require('express'),
  router = express.Router(),
  mongoose = require('mongoose'),
  PropertiesReader = require('properties-reader');

var properties = PropertiesReader('config/production.properties');

module.exports = function(app) {
  app.use('/', router);
};

router.get('/', function(req, res, next) {
  res.render('index', {
    title: properties.get('home.title'),
    uri: properties.get('home.uri')
  });
});
