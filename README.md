# cca

### Dependencies

#### Install GIT
```bash
$ sudo apt-get update
$ sudo apt-get install git
```

- Install MongoDB: [https://docs.mongodb.org/manual/tutorial/install-mongodb-on-ubuntu/](https://docs.mongodb.org/manual/tutorial/install-mongodb-on-ubuntu/)
- Install NodeJS
- Install PM2:
```bash
$ npm install pm2 -g
```

### Clone & run
```bash
$ cd
$ git clone https://github.com/nrullo/cca.git
$ cd cca
$ pm2 start app.js
$ pm2 startup ubuntu
$ pm2 save
```
