const express = require('express');
const { isLoggedIn, isNotLoggedIn } = require('./middlewares');
const { Auction,Tokdil, Post, User, Hashtag } = require('../models');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const schedule = require('node-schedule');
const { Op } = require('Sequelize');

const router = express.Router();

router.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.followerCount = req.user ? req.user.Followers.length : 0;
  res.locals.followingCount = req.user ? req.user.Followings.length : 0;
  res.locals.followerIdList = req.user ? req.user.Followings.map(f => f.id) : [];
  next();
});

router.get('/profile', isLoggedIn, (req, res) => {
  res.render('profile', { title: '내 정보 - snsShop' });
});

router.get('/join', isNotLoggedIn, (req, res) => {
  res.render('join', { title: '회원가입 - snsShop' });
});

router.get('/Tokdil', async (req, res, next) => {
  try {
    const Tokdils = await Tokdil.findAll({ where: { SoldId: null } });
    res.render('Tokdil', {
      title: 'Tokdil',
      Tokdils,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

router.get('/auction', isLoggedIn, (req, res) => {
  res.render('auction', { title: '상품 등록 - Auction' });
});

router.get('/Tokdil/:id', isLoggedIn, async (req, res, next) => {
  try {
    const [tokdil, auction] = await Promise.all([
      Tokdil.findOne({
        where: { id: req.params.id },
        include: {
          model: User,
          as: 'Owner',
        },
      }),
      Auction.findAll({
        where: { TokdilId: req.params.id },
        include: { model: User },
        order: [['bid', 'ASC']],
      }),
    ]);
    res.render('tokdiling', {
      title: `${tokdil.name} - Auction`,
      tokdil,
      auction,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

router.post('/Tokdil/:id/bid', isLoggedIn, async (req, res, next) => {
    try {
      const { bid, msg } = req.body;
      const tokdil = await Tokdil.findOne({
        where: { id: req.params.id },
        include: { model: Auction },
        order: [[{ model: Auction }, 'bid', 'DESC']],
    });

    if (new Date(tokdil.createdAt).valueOf() + (24 * 60 * 60 * 1000) < new Date()) {
      return res.status(403).send('구매시간이');
    }
    if (tokdil.Auctions[0] && tokdil.Auctions[0].bid >= bid) {
      return res.status(403).send('참여자가 있습니다.');
    }

    const result = await Auction.create({
      bid,
      msg,
      UserId: req.user.id,
      TokdilId: req.params.id,
    });

    req.app.get('io').to(req.params.id).emit('bid', {
      bid: result.bid,
      msg: result.msg,
      nick: req.user.nick,
    });
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate());
    const targets = await Tokdil.findAll({
      where: {
        id: req.params.id,
        createdAt: { [Op.lte]: yesterday },
      },
    });
    targets.forEach(async (target) => {
      const success = await Auction.findOne({
        where: { TokdilId: target.id },
        order: [['bid', 'DESC']],
      });
      Tokdil.update({ SoldId: success.UserId }, { where: { id: target.id } });
    });

    return res.send('ok');
  } catch (error) {
    console.error(error);
    return next(error);
  }
});

try {
  fs.readdirSync('uploads');
} catch (error) {
console.error('uploads 폴더가 없어 uploads 폴더를 생성합니다.');
fs.mkdirSync('uploads');
}
const upload3 = multer({
storage: multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, path.basename(file.originalname, ext) + new Date().valueOf() + ext);
  },
}),
limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/Tokdil', isLoggedIn, upload3.single('img'), async (req, res, next) => {
try {
  const { name, price } = req.body;
  const tokdil =await Tokdil.create({
    OwnerId: req.user.id,
    name,
    img: req.file.filename,
    price,
  });

  const end = new Date();
  end.setDate(end.getDate() + 1); // 하루 뒤
  schedule.scheduleJob(end, async () => {
    const success = await Auction.findOne({
      where: { TokdilId: tokdil.id },
      order: [['bid', 'DESC']],
    });
    await Tokdil.update({ SoldId: success.UserId }, { where: { id: tokdil.id } });
    await User.update({
      money: sequelize.literal(`money - ${success.bid}`),
    }, {
      where: { id: success.UserId },
    });
  });

  res.redirect('/');
} catch (error) {
  console.error(error);
  next(error);
}
});
  
router.get('/', async (req, res, next) => {
  try {
    const posts = await Post.findAll({
      include: {
        model: User,
        attributes: ['id', 'nick'],
      },
      order: [['createdAt', 'DESC']],
    });
    res.render('main', {
      title: 'snsShop',
      twits: posts,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get('/hashtag', async (req, res, next) => {
  const query = req.query.hashtag;
    if (!query) {
      return res.redirect('/');
    }
    try {
      const hashtag = await Hashtag.findOne({ where: { title: query } });
      let posts = [];
      if (hashtag) {
        posts = await hashtag.getPosts({ include: [{ model: User }] });
      }

      return res.render('main', {
        title: `${query} | snsSnop`,
        twits: posts,
      });
    } catch (error) {
      console.error(error);
      return next(error);
    }
});

router.get('/list', isLoggedIn, async (req, res, next) => {
  try {
    const tokdils = await Tokdil.findAll({
      where: { SoldId: req.user.id },
      include: { model: Auction },
      order: [[{ model: Auction }, 'bid', 'DESC']],
    });
    res.render('list', { title: '구매 목록 - NodeAuction', tokdils });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

module.exports = router;