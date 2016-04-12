var express = require('express'),
  router = express.Router(),
  mongoose = require('mongoose'),
  Contribuyente = mongoose.model('Contribuyente');

module.exports = function(app) {
  app.use('/', router);
};

router.get('/contribuyentes/:cuit', function(req, res, next) {
  Contribuyente.find({
    cuit: req.params.cuit
  }, function(err, contribuyente) {
    if (err) return next(err);
    res.send(contribuyente);
  });
});

router.get('/contribuyentes', function(req, res, next) {
  Contribuyente.find({}, function(err, contribuyentes) {
    if (err) return next(err);
    res.send(contribuyentes);
  }).limit(500);
});
