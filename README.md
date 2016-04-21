# cca

## Dependencies

### Install GIT
#### Ubuntu 14.04 ([ext. guide](https://www.digitalocean.com/community/tutorials/how-to-install-git-on-ubuntu-14-04))
```bash
sudo apt-get update
sudo apt-get install git
```
#### CentOS 6.7 ([ext. guide](https://www.digitalocean.com/community/tutorials/how-to-install-git-on-a-centos-6-4-vps))
```bash
sudo yum update
sudo yum install git
```

### Install MongoDB
_*recommended version: 3.2_
#### Ubuntu 14.04 ([ext. guide](https://docs.mongodb.org/manual/tutorial/install-mongodb-on-ubuntu/))
```bash
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv EA312927
echo "deb http://repo.mongodb.org/apt/ubuntu trusty/mongodb-org/3.2 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.2.list
sudo apt-get update
sudo apt-get install -y mongodb-org
```
#### CentOS 6.7 ([ext. guide](https://docs.mongodb.org/manual/tutorial/install-mongodb-on-red-hat/))
```bash
sudo vi /etc/yum.repos.d/mongodb-org-3.2.repo
```
```
[mongodb-org-3.2]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/6/mongodb-org/3.2/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-3.2.asc
```
```bash
sudo yum install -y mongodb-org
sudo chkconfig mongod on
sudo service mongod start
```

### Install NodeJS 
_*recommended version: 4.1.1_
#### Ubuntu 14.04 or Centos 6.7 ([ext. guide](https://github.com/creationix/nvm/blob/master/README.markdown))
```bash
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | bash
nvm install 4.1.1
nvm use 4.1.1
n=$(which node);n=${n%/bin/node}; chmod -R 755 $n/bin/*; sudo cp -r $n/{bin,lib,share} /usr/local
```

### Install PM2
```bash
npm install pm2 -g
```

## Clone & run
```bash
mkdir ~/warez
cd ~/warez
git clone https://github.com/nrullo/cca.git
cd cca
npm install
pm2 start app.js
pm2 startup [ubuntu|centos]
pm2 save
```
