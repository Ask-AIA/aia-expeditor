import { Module } from '@nestjs/common';
import { ConfigModule } from './shared/config/config.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [ConfigModule, SharedModule],
})
export class AppModule {}
