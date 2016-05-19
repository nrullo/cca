var express = require('express'),
  router = express.Router();

var db = require('../../db');

module.exports = function(app) {
  app.use('/', router);
};

router.get('/contribuyentes/:cuit', function(req, res, next) {
  var contribuyentes = db.get().collection('contribuyentes');

  contribuyentes.find({
    cuit: req.params.cuit
  }).toArray(function(err, data) {
    res.send(data);
  });
});

router.get('/contribuyentes', function(req, res, next) {
  var contribuyentes = db.get().collection('contribuyentes');

  contribuyentes.find({}).limit(500).toArray(function(err, data) {
    res.send(data);
  });
});
