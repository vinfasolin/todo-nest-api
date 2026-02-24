/*
  Warnings:

  - A unique constraint covering the columns `[userId,createdAt,id]` on the table `Todo` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE INDEX "Todo_userId_createdAt_id_idx" ON "Todo"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Todo_userId_createdAt_id_key" ON "Todo"("userId", "createdAt", "id");
