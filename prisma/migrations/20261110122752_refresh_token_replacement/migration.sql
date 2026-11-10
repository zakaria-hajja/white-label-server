-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "replaced_by_id" UUID,
ADD COLUMN     "superseded_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "refresh_tokens_replaced_by_id_idx" ON "refresh_tokens"("replaced_by_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
