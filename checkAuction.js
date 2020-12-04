const { Op } = require('Sequelize');

const { Tokdil, Auction, User, sequelize } = require('./models');

module.exports = async () => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targets = await Tokdil.findAll({
      where: {
        SoldId: null,
        createdAt: { [Op.lte]: yesterday },
      },
    });
    targets.forEach(async (target) => {
      const success = await Auction.findOne({
        where: { TokdilId: target.id },
        order: [['bid', 'DESC']],
      });
      await Tokdil.update({ SoldId: success.UserId }, { where: { id: target.id } });
      await User.update({
        money: sequelize.literal(`money - ${success.bid}`),
      }, {
        where: { id: success.UserId },
      });
    });
  } catch (error) {
    console.error(error);
  }
};