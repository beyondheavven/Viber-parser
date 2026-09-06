import { ApiProperty } from '@nestjs/swagger';

export class StopTaskResponseDto {
  @ApiProperty({ type: String, example: 'task_1725547890123' })
  taskId!: string;

  @ApiProperty({ type: String, example: 'stopped' })
  status!: string;

  @ApiProperty({ type: String, example: 'Задача успешно остановлена' })
  message!: string;
}
