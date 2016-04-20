# cca

## Dependencies

### Install GIT ([ext. guide](https://www.digitalocean.com/community/tutorials/how-to-install-git-on-ubuntu-14-04))
```bash
sudo apt-get update
sudo apt-get install git
```

### Install MongoDB ([ext. guide](https://docs.mongodb.org/manual/tutorial/install-mongodb-on-ubuntu/))
_tested on v3.2_
```bash
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv EA312927
echo "deb http://repo.mongodb.org/apt/ubuntu trusty/mongodb-org/3.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.2.list
sudo apt-get update
sudo apt-get install -y mongodb-org
```

### Install NodeJS ([ext. guide](https://www.digitalocean.com/community/tutorials/how-to-install-node-js-with-nvm-node-version-manager-on-a-vps))
_tested on v4.1.1_

### Install PM2:
```bash
$ npm install pm2 -g
```

## Clone & run
```bash
$ cd
$ git clone https://github.com/nrullo/cca.git
$ cd cca
$ pm2 start app.js
$ pm2 startup ubuntu
$ pm2 save
```
