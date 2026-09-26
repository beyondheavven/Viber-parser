import { Catch, RpcExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';

@Catch()
export class AllExceptionsFilter implements RpcExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: any, _host: ArgumentsHost): Observable<any> {
    const res = exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof res === 'object' && res !== null && 'message' in res
        ? (res as any).message
        : exception?.message ?? 'Internal server error';

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;

    const formattedMessage = Array.isArray(message) ? message.join(', ') : String(message);

    this.logger.error(`RPC Exception [${statusCode}]: ${formattedMessage}`);

    return throwError(() => ({
      status: 'error',
      statusCode,
      message: formattedMessage,
    }));
  }
}
