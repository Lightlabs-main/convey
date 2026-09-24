import ClaimScreen from "./ClaimScreen";

export default async function GiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ secret: string }>;
  searchParams: Promise<{ giftId?: string }>;
}) {
  const [{ secret }, query] = await Promise.all([params, searchParams]);
  return <ClaimScreen secret={secret} giftId={query.giftId ?? ""} />;
}
