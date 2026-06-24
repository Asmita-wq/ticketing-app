import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  signupSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from '../validators/auth.validators';

export const authRoutes = Router();

authRoutes.post('/signup', validate({ body: signupSchema }), authController.signup);
authRoutes.post('/verify-otp', validate({ body: verifyOtpSchema }), authController.verifyOtp);
authRoutes.post('/resend-otp', validate({ body: resendOtpSchema }), authController.resendOtp);
authRoutes.post('/login', validate({ body: loginSchema }), authController.login);
authRoutes.post('/refresh', validate({ body: refreshTokenSchema }), authController.refresh);
authRoutes.post('/logout', validate({ body: refreshTokenSchema }), authController.logout);
authRoutes.post(
  '/forgot-password',
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);
authRoutes.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);

authRoutes.get('/profile', authenticate, authController.getProfile);
authRoutes.patch(
  '/profile',
  authenticate,
  validate({ body: updateProfileSchema }),
  authController.updateProfile,
);
authRoutes.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);
