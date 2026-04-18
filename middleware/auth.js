const adminAuth = (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

const sessionAuth = (req, res, next) => {
  if (!req.session || !req.session.admin) {
    return res.redirect('/admin/login');
  }
  next();
};

module.exports = { adminAuth, sessionAuth };