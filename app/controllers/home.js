var express = require('express'),
  router = express.Router(),
  mongoose = require('mongoose');

module.exports = function(app) {
  app.use('/', router);
};

router.get('/', function(req, res, next) {
  res.render('index', {
    title: 'Rest API - Contribuyentes de AFIP - Constancia de inscripción',
    uri: "vodemia.com"
  });
});
