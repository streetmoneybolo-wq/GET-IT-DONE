// Automated alerts require an explicit identity on the matching source channel.
// Display names are not identities; arbitrary relays must remain excluded.
export function acceptsAlertAuthor(source, message) {
  if (message.webhookId) {
    if (!source?.webhookIds?.includes(message.webhookId)) return false;
    if (message.author?.id !== message.webhookId) return false;
  } else if (message.author?.bot) {
    if (!source?.botAuthorIds?.includes(message.author.id)) return false;
  }
  return !source?.authorIds?.length || source.authorIds.includes(message.author?.id);
}
