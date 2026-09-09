export interface LoginPhoneDto {
  phoneNumber: string;
  countryName?: string;
  countryCode?: string;
}

export interface ConfirmCodeDto {
  code: string;
}

export interface AuthResponseDto {
  success: boolean;
  message: string;
  step?: 'PHONE_INPUT' | 'WAITING_FOR_CODE' | 'AUTHORIZED' | 'ERROR';
}

export interface AuthStatusDto {
  isAppRunning: boolean;
  isAuthorized: boolean;
  step?: 'PHONE_INPUT' | 'WAITING_FOR_CODE' | 'AUTHORIZED' | 'UNKNOWN';
}
