export interface LoginPhoneDto {
  phoneNumber?: string;
  countryName?: string;
  countryCode?: string;
  /** Wipe Viber's data first, so the flow starts from the welcome splash. */
  clearData?: boolean;
}

export interface ConfirmCodeDto {
  code: string;
  /** Typed into the "Your name" profile screen; left as Viber prefills it when absent. */
  userName?: string;
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
