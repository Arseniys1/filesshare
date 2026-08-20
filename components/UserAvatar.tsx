import { Avatar, Style } from "@dicebear/core";
import personas from "@dicebear/styles/personas.json" with { type: "json" };
import Image from "next/image";

interface UserAvatarProps {
  email: string;
  seed?: string | null;
  size?: number;
  className?: string;
}

const avatarStyle = new Style(personas);

export default function UserAvatar({
  email,
  seed,
  size = 32,
  className = "",
}: UserAvatarProps) {
  const avatarSeed = seed?.trim() || email.trim().toLowerCase();
  const avatar = new Avatar(avatarStyle, {
    seed: avatarSeed || "anonymous",
    size,
    borderRadius: 50,
  });

  return (
    <Image
      src={avatar.toDataUri()}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 rounded-full ${className}`.trim()}
    />
  );
}
